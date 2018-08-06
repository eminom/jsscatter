

## Export NODE_PATH to the path where your athandler resides.
## For example:
* on windows: set NODE_PATH=pathto\x\yy\zzz\node_modules
* on liux: export NODE_PATH=pathto\x\yy\zzz\node_modules

```js

const dgram = require('dgram');
const createAtSocket = require('athandler').createElSock;
const vmSocket = require('athandler').atSocketv2;

module.exports = {
    createUDPSocket,
    createAtSocket: () => {
        return createAtSocket(vmSocket);
    },
};

function createUDPSocket() {
    return new Promise((r, c) => {
        setTimeout(() => r(dgram.createSocket('udp4')), 0);
    });
}

```