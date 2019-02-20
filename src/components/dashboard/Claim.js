// @flow
import React, { Component } from 'react'
import { StyleSheet, View, Image } from 'react-native'
import { normalize } from 'react-native-elements'
import { PushButton } from '../appNavigation/stackNavigation'
import { AccountConsumer } from '../appNavigation/AccountProvider'
import type { DashboardProps } from './Dashboard'
import { Wrapper, Section, BigNumber, TopBar } from '../common'

type ClaimProps = DashboardProps

class Claim extends Component<ClaimProps, {}> {
  static navigationOptions = { title: 'Claim GD' }

  render() {
    const { screenProps }: ClaimProps = this.props

    return (
      <AccountConsumer>
        {({ balance, entitlement }) => (
          <Wrapper>
            <TopBar balance={balance} />
            <Section>
              <Section.Title>
                GoodDollar is a good economy, each day you can collect your part in the economy
              </Section.Title>
              <Section.Row style={styles.centered}>
                <Section.Text>{`TODAY'S DAILY INCOME `}</Section.Text>
                <BigNumber number={entitlement} unit={'GD'} />
              </Section.Row>
              <Image style={styles.graph} source={require('./graph.png')} />
            </Section>
            <Section>
              <Section.Row style={styles.centered}>
                <Section.Text>
                  <b>367K</b> PEOPLE CLAIMED <b>2.5M GD</b> TODAY!
                </Section.Text>
              </Section.Row>
            </Section>
            <Section>
              <Section.Title>
                YOU NOW HAVE <b>3</b> DAYS OF INCOME WAITING
              </Section.Title>
              <Section.Separator />
              <Section.Text>NEXT DAILY INCOME:</Section.Text>
              <Section.Row style={styles.centered}>
                <BigNumber number={'23:59:59'} />
              </Section.Row>
            </Section>
            <View>
              <PushButton
                disabled={!+entitlement}
                routeName={'FaceRecognition'}
                screenProps={screenProps}
                style={[styles.buttonLayout, styles.signUpButton]}
              >
                {`CLAIM YOUR SHARE - ${entitlement} GD`}
              </PushButton>
            </View>
          </Wrapper>
        )}
      </AccountConsumer>
    )
  }
}

const styles = StyleSheet.create({
  buttonLayout: {
    marginTop: 30,
    padding: 10
  },
  buttonText: {
    fontFamily: 'Helvetica, "sans-serif"',
    fontSize: normalize(16),
    color: 'white',
    fontWeight: 'bold'
  },
  signUpButton: {
    backgroundColor: '#555555'
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'baseline'
  },
  graph: {
    width: '323px',
    maxWidth: '100%',
    height: '132px',
    alignSelf: 'center'
  }
})

export default Claim
