// @flow
import type Web3 from 'web3'
import WalletFactory from './WalletFactory'
import IdentityABI from '@gooddollar/goodcontracts/build/contracts/Identity.json'
import RedemptionABI from '@gooddollar/goodcontracts/build/contracts/RedemptionFunctional.json'
import GoodDollarABI from '@gooddollar/goodcontracts/build/contracts/GoodDollar.json'
import ReserveABI from '@gooddollar/goodcontracts/build/contracts/GoodDollarReserve.json'
import OneTimePaymentLinksABI from '@gooddollar/goodcontracts/build/contracts/OneTimePaymentLinks.json'
import logger from '../../lib/logger/pino-logger'
import Config from '../../config/config'

const log = logger.child({ from: 'GoodWallet' })

/**
 * the HDWallet account to use.
 * we use different accounts for different actions in order to preserve privacy and simplify things for user
 * in background
 */
const AccountUsageToPath = {
  gd: 0,
  gundb: 1,
  eth: 2,
  donate: 3
}
export type AccountUsage = $Keys<typeof AccountUsageToPath>
export class GoodWallet {
  ready: Promise<Web3>
  wallet: Web3
  accountsContract: Web3.eth.Contract
  tokenContract: Web3.eth.Contract
  identityContract: Web3.eth.Contract
  claimContract: Web3.eth.Contract
  reserveContract: Web3.eth.Contract
  oneTimePaymentLinksContract: Web3.eth.Contract
  account: string
  accounts: Array<string>
  networkId: number
  gasPrice: number

  constructor() {
    this.init()
  }

  init(): Promise<any> {
    const ready = WalletFactory.create('software')
    this.ready = ready
      .then(wallet => {
        this.wallet = wallet
        this.account = this.wallet.eth.defaultAccount
        this.accounts = this.wallet.eth.accounts.wallet
        this.networkId = Config.networkId
        this.gasPrice = wallet.utils.toWei('1', 'gwei')
        this.identityContract = new this.wallet.eth.Contract(
          IdentityABI.abi,
          IdentityABI.networks[this.networkId].address,
          { from: this.account }
        )
        this.claimContract = new this.wallet.eth.Contract(
          RedemptionABI.abi,
          RedemptionABI.networks[this.networkId].address,
          { from: this.account }
        )
        this.tokenContract = new this.wallet.eth.Contract(
          GoodDollarABI.abi,
          GoodDollarABI.networks[this.networkId].address,
          { from: this.account }
        )
        this.reserveContract = new this.wallet.eth.Contract(
          ReserveABI.abi,
          ReserveABI.networks[this.networkId].address,
          {
            from: this.account
          }
        )
        this.oneTimePaymentLinksContract = new this.wallet.eth.Contract(
          OneTimePaymentLinksABI.abi,
          OneTimePaymentLinksABI.networks[this.networkId].address,
          {
            from: this.account
          }
        )
        log.info('GoodWallet Ready.')
      })
      .catch(e => {
        log.error('Failed initializing GoodWallet', e)
        throw e
      })
    return this.ready
  }

  async claim() {
    try {
      const gas = await this.claimContract.methods.claimTokens().estimateGas()
      return this.claimContract.methods.claimTokens().send({
        gas,
        gasPrice: await this.gasPrice
      })
    } catch (e) {
      log.info(e)
      return Promise.reject(e)
    }
  }

  async checkEntitlement() {
    return await this.claimContract.methods.checkEntitlement().call()
  }

  balanceChanged(callback: (error: any, event: any) => any): [Promise<any>, Promise<any>] {
    const fromHanlder: Promise<any> = this.tokenContract.events.Transfer(
      { fromBlock: 'latest', filter: { from: this.account } },
      callback
    )
    const toHandler: Promise<any> = this.tokenContract.events.Transfer(
      { fromBlock: 'latest', filter: { to: this.account } },
      callback
    )

    return [toHandler, fromHanlder]
  }

  async balanceOf() {
    return this.tokenContract.methods
      .balanceOf(this.account)
      .call()
      .then(b => {
        b = this.wallet.utils.fromWei(b, 'ether')
        return b
      })
  }

  signMessage() {}

  sendTx() {}

  async getAccountForType(type: AccountUsage) {
    let account = this.accounts[AccountUsageToPath[type]].address || this.account
    return account
  }

  async sign(toSign: string, accountType: AccountUsage = 'gd') {
    let account = await this.getAccountForType(accountType)
    return this.wallet.eth.sign(toSign, account)
  }

  async isVerified(address: string): Promise<boolean> {
    const tx: boolean = await this.identityContract.methods.isVerified(address).call()
    return tx
  }

  async isCitizen(): Promise<boolean> {
    const tx: boolean = await this.identityContract.methods.isVerified(this.account).call()
    return tx
  }

  async canSend(amount: number) {
    const balance = await this.balanceOf()
    return amount < balance
  }

  async generateLink(amount: number) {
    if (!(await this.canSend(amount))) {
      throw new Error(`Amount is bigger than balance`)
    }
    const generatedString = this.wallet.utils.sha3(this.wallet.utils.randomHex(10))
    const gasPrice = await this.gasPrice
    log.debug('this.oneTimePaymentLinksContract', this.oneTimePaymentLinksContract)
    log.debug('this.tokenContract', this.tokenContract)

    const encodedABI = await this.oneTimePaymentLinksContract.methods
      .deposit(this.account, generatedString, amount)
      .encodeABI()
    const gas = await this.tokenContract.methods
      .transferAndCall(this.oneTimePaymentLinksContract.defaultAccount, amount, encodedABI)
      .estimateGas()
      .catch(err => {
        log.error(err)
        throw err
      })

    const balancePre = await this.tokenContract.methods
      .balanceOf(this.oneTimePaymentLinksContract.defaultAccount)
      .call()
    log.debug({ amount, gas, gasPrice, balancePre, onePaymentAccount: this.oneTimePaymentLinksContract.defaultAccount })
    const tx = await this.tokenContract.methods
      .transferAndCall(this.oneTimePaymentLinksContract.defaultAccount, amount, encodedABI)
      .send({ gas, gasPrice })
      .on('transactionHash', hash => log.debug({ hash }))
      .catch(err => {
        log.error({ err })
        throw err
      })
    const balancePost = await this.tokenContract.methods.balanceOf(this.account).call()
    log.debug({ tx, balancePost, onePaymentAccount: this.oneTimePaymentLinksContract.defaultAccount })
    return `${Config.publicUrl}/AppNavigation/Dashboard/ReceiveLink/${generatedString}`
  }
}
export default new GoodWallet()
