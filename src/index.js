// @flow

import React from 'react'
import ReactDOM from 'react-dom'
import fontMaterialIcons from 'react-native-vector-icons/Fonts/MaterialIcons.ttf'
import './index.css'
import App from './App'
import './components/common/view/Icon/index.css'
import { default as SimpleStore } from './lib/undux/SimpleStore'

let ErrorBoundary = React.Fragment

const { hot } = require('react-hot-loader')
const HotApp = hot(module)(App)

ReactDOM.render(
  <ErrorBoundary>
    <SimpleStore.Container>
      <HotApp />
      <style type="text/css">{`
            @font-face {
              src: url(${fontMaterialIcons});
              font-family: MaterialIcons;
            }
          `}</style>
    </SimpleStore.Container>
  </ErrorBoundary>,
  document.getElementById('root'),
)
