

## Export NODE_PATH to the path where your athandler resides.
## For example:
* on windows: set NODE_PATH=pathto\x\yy\zzz\node_modules
* on liux: export NODE_PATH=pathto\x\yy\zzz\node_modules

```js

const dgram = require('dgram');
const createAtSocket = require('athandler').createElSock;

const vmSocket = require('athandler').atSocketv2;
const vmSocketG = require('athandler').atSocketG;
const detectDev = require('athandler').detectDev;

module.exports = {
    createUDPSocket,
    createAtSocket: () => detectDev().then((model) => {
        if (model === 'variant') {
            console.log("variant interface");
            return createAtSocket(vmSocketG);
        } else {
            console.log("hisi interface");
            return createAtSocket(vmSocket);
        }
    }),
};

function createUDPSocket() {
    return new Promise((r, c) => {
        setTimeout(() => r(dgram.createSocket('udp4')), 0);
    });
}


```
