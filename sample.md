
```js
const dgram = require('dgram');
const createAtSocket = require('pathto/elsock');

module.exports = {
    createUDPSocket,
    createAtSocket,
};

function createUDPSocket() {
    return new Promise((r, c) => {
        setTimeout(() => r(dgram.createSocket('udp4')), 0);
    });
}

```