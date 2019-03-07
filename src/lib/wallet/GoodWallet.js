// @flow
import GoodDollarABI from '@gooddollar/goodcontracts/build/contracts/GoodDollar.json'
import ReserveABI from '@gooddollar/goodcontracts/build/contracts/GoodDollarReserve.json'
import IdentityABI from '@gooddollar/goodcontracts/build/contracts/Identity.json'
import OneTimePaymentLinksABI from '@gooddollar/goodcontracts/build/contracts/OneTimePaymentLinks.json'
import RedemptionABI from '@gooddollar/goodcontracts/build/contracts/RedemptionFunctional.json'
import _ from 'lodash'
import type Web3 from 'web3'
import { utils } from 'web3'

import Config from '../../config/config'
import logger from '../../lib/logger/pino-logger'
import WalletFactory from './WalletFactory'

const log = logger.child({ from: 'GoodWallet' })

const { BN, toBN } = utils
const ZERO = new BN('0')

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

type QueryEvent = {
  event: string,
  contract: Web3.eth.Contract,
  filter: {},
  fromBlock: typeof BN,
  toBlock: typeof BN
}

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
        gasPrice: await this.wallet.eth.getGasPrice()
      })
    } catch (e) {
      log.info(e)
      return Promise.reject(e)
    }
  }

  async checkEntitlement() {
    return await this.claimContract.methods.checkEntitlement().call()
  }

  /**
   * Listen to balance changes for the current account
   * @param cb
   * @returns {Promise<void>}
   */
  async balanceChanged(cb: Function) {
    const toBlock = await this.wallet.eth.getBlockNumber().then(toBN)

    this.pollForEvents(
      {
        event: 'Transfer',
        contract: this.tokenContract,
        fromBlock: new BN('0'),
        toBlock,
        filter: { from: this.account }
      },
      cb
    )

    this.pollForEvents(
      {
        event: 'Transfer',
        contract: this.tokenContract,
        fromBlock: new BN('0'),
        toBlock,
        filter: { to: this.account }
      },
      cb
    )
  }

  /**
   * Client side event filter. Requests all events for a particular contract, then filters them and returns the event Object
   * @param {String} event - Event to subscribe to
   * @param {Object} contract - Contract from which event will be queried
   * @param {Object} filter - Event's filter. Does not required to be indexed as it's filtered locally
   * @param {BN} fromBlock - Lower blocks range value
   * @param {BN} toBlock - Higher blocks range value
   * @returns {Promise<*>}
   */
  async getEvents({ event, contract, filter, fromBlock = ZERO, toBlock }: QueryEvent): Promise<[]> {
    const events = await contract.getPastEvents('allEvents', { fromBlock, toBlock })

    return _(events)
      .filter({ event })
      .filter({ returnValues: { ...filter } })
      .value()
  }

  /**
   * Subscribes to a particular event and returns the result based on options specified
   * @param {String} event - Event to subscribe to
   * @param {Object} contract - Contract from which event will be queried
   * @param {Object} filter - Event's filter. Does not required to be indexed as it's filtered locally
   * @param {BN} fromBlock - Lower blocks range value
   * @param {BN} toBlock - Higher blocks range value
   * @param {Function} callback - Function to be called once an event is received
   * @returns {Promise<void>}
   */
  async oneTimeEvents({ event, contract, filter, fromBlock, toBlock }: QueryEvent, callback: Function) {
    try {
      const events = await this.getEvents({ event, contract, filter, fromBlock, toBlock })
      log.debug({ events: events.length, ...filter, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() })
      if (events.length) {
        callback(null, events)
      }
    } catch (e) {
      log.error({ e })
      callback(e, [])
    }
  }

  /**
   * Polls for events every INTERVAL defined by BLOCK_TIME and BLOCK_COUNT, the result is based on specified options
   * It queries the range 'fromBlock'-'toBlock' and then continues querying the blockchain for most recent events, from
   * the 'lastProcessedBlock' to the 'latest' every INTERVAL
   * @param {String} event - Event to subscribe to
   * @param {Object} contract - Contract from which event will be queried
   * @param {Object} filter - Event's filter. Does not required to be indexed as it's filtered locally
   * @param {BN} fromBlock - Lower blocks range value
   * @param {BN} toBlock - Higher blocks range value
   * @param {Function} callback - Function to be called once an event is received
   * @param {BN} lastProcessedBlock - Used for recursion. It's not required to be set by the user. Initial value: ZERO
   * @returns {Promise<void>}
   */
  async pollForEvents(
    { event, contract, filter, fromBlock, toBlock }: QueryEvent,
    callback: Function,
    lastProcessedBlock: typeof BN = ZERO
  ) {
    const BLOCK_TIME = 2500
    const BLOCK_COUNT = 1
    const INTERVAL = BLOCK_COUNT * BLOCK_TIME
    const lastBlock = await this.wallet.eth.getBlockNumber().then(toBN)

    if (lastProcessedBlock.lt(lastBlock)) {
      fromBlock = toBlock
      toBlock = lastBlock
      await this.oneTimeEvents({ event, contract, filter, fromBlock, toBlock }, callback)
    } else {
      log.debug('all blocks processed', {
        toBlock: toBlock.toString(),
        lastBlock: lastBlock.toString()
      })
    }

    log.debug('about to recurse')
    setTimeout(() => this.pollForEvents({ event, contract, filter, fromBlock, toBlock }, callback, toBlock), INTERVAL)
  }

  async balanceOf() {
    return this.tokenContract.methods.balanceOf(this.account).call()
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
    const gasPrice = await this.getGasPrice()
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
    return { sendLink: `${Config.publicUrl}/AppNavigation/Dashboard/ReceiveLink/${generatedString}`, receipt: tx }
  }

  async getGasPrice() {
    let gasPrice = this.gasPrice

    try {
      const { toBN } = this.wallet.utils
      const networkGasPrice = toBN(await this.wallet.eth.getGasPrice())

      if (networkGasPrice.gt(toBN('0'))) {
        gasPrice = networkGasPrice.toString()
      }
    } catch (e) {
      log.error('failed to retrieve gas price from network', { e })
    }

    return gasPrice
  }

  async sendAmount(to: string, amount: number) {
    if (!this.wallet.utils.isAddress(to)) {
      throw new Error('Address is invalid')
    }

    if (amount === 0 || !(await this.canSend(amount))) {
      throw new Error('Amount is bigger than balance')
    }

    const gasPrice = await this.getGasPrice()
    log.info({ gasPrice, thisGasPrice: this.gasPrice })

    const handleError = err => {
      log.error({ err })
      throw err
    }

    const transferCall = this.tokenContract.methods.transfer(to, amount)
    const gas = await transferCall.estimateGas().catch(handleError)

    log.debug({ amount, to, gas })

    return await transferCall
      .send({ gas, gasPrice })
      .on('transactionHash', hash => log.debug({ hash }))
      .catch(handleError)
  }
}
export default new GoodWallet()
