'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopBootstrapBridge', {
  sendPassword(value) { ipcRenderer.send('spexcode-sudo-password', value) },
})
