
// npm install coap --save
const util = require('util');
const fs = require('fs');

const crypto = require('crypto');

const path = require('path');
const mkdirp = require('mkdirp');

const adapter = require('./adapter');
const Messenger = require('./messenger');
const coap = require('./coapdefs');

const createFragger = require('./fragger');

let fatalLog = console.error;
let traceLog = console.error;
let warnLog = console.error;

//let infoLog = function () { };
let infoLog = console.log;

class MsgEx extends Messenger {
    constructor(fragger) {
        let args = Array.from(arguments);
        super(...args.splice(1));
        this.fragger = fragger;
    }

    writeOpen() {
        return new Promise((r, c) => {
            this.sendReq({
                code: coap.POST,
                options: [].concat(this.genUriPaths("wr", path.basename(this.fragger.filename))),
                payload: Buffer.from(this.fragger.totalCount.toString()),
                callback: (resp) => r(parseInt(resp.payload)),
            });
        });
    }

    writeOne(shortID, index, sig, chunk, cb) {
        process.stdout.write('.');
        this.sendReq({
            code: coap.PUT,
            options: [].concat(this.genUriPaths("f", shortID, index, 0)),
            payload: sig,
            callback: (resp) => {
                if (resp.code != coap.Changed) {
                    //TODO
                    fatalLog("error sending one msg");
                }

                //
                this.sendReq({
                    code: coap.PUT,
                    options: [].concat(this.genUriPaths("f", shortID, index, 1)),
                    payload: chunk,
                    callback: (resp) => {
                        if (resp.code != coap.Changed) {
                            //TODO
                            fatalLog("error sending one msg");
                        }
                        cb();
                    },
                });
            }
        });
    }

    writeClose(shortID, finSig, cb) {
        this.sendReq({
            code: coap.POST,
            options: [].concat(this.genUriPaths("fin", shortID)),
            payload: finSig,
            callback: (resp) => {
                if (resp.code == coap.Changed) {
                    infoLog("well done");
                }
                cb();
            },
        });
    }

    doUpload() {
        return new Promise((r, c) => {
        });
    }
}

function parseArguments() {
    // main
    let fileName = "<?>";
    let elHost = "172.16.53.182";
    let elPort = 16666;
    let elss = 512;
    let args = process.argv.reduce((p, v) => {
        if (/[\w\d\.]+:\d+/.test(v)) {
            [elHost, elPort] = v.split(":");
            return p;
        }
        let m = /-f=(\d+)/.exec(v);
        if (m) {
            elss = parseInt(m[1]);
            return p;
        }
        if (v !== '-udp') {
            p.push(v);
        };
        return p;
    }, []);
    // console.log("Host: ", elHost);
    // console.log("Port: ", elPort);
    // console.log("<", args, ">");
    if (typeof (args[2]) === 'string') {
        fileName = args[2];
    }
    let useUDP = process.argv.reduce((p, v) => p |= (v === '-udp'), false);
    return [fileName, elss, elHost, elPort, useUDP];
}

[fileName, elss, elHost, elPort, useUDP] = parseArguments();
let creator = adapter.createUDPSocket;
if (!useUDP) {
    infoLog("use AT");
    creator = adapter.createAtSocket;
}

createFragger(fileName, elss
).then(fragger => new Promise((r, c) => {
    creator().then((sock) => r([fragger, sock]));
})).then(([fragger, sock]) => new Promise((r, c) => {
    fragger.startRead().then((readFunc) => r([fragger, sock, readFunc]));
})).then(([fragger, sock, readFunc]) => {
    let msr = new MsgEx(fragger, sock, elHost, elPort);
    return new Promise((r, c) => {
        msr.writeOpen().then((shortID) => {
            // infoLog("short-id for write: ", shortID);
            if (isNaN(shortID)) {
                fatalLog("rejected by server:", shortID);
                process.exit(1);
            }
            let doOnce = () => {
                readFunc((data, sig, index) => {
                    msr.writeOne(shortID, index, sig, data, () => doOnce());
                }, (finSig) => r([shortID, finSig, msr]), (err) => {
                });
            };
            doOnce();
        });
    });
}).then(([shortID, finSig, msr]) => new Promise((r, c) => {
    msr.writeClose(shortID, finSig, () => r());
})).then(() => {
    infoLog("done");
    process.exit(0);
}).catch((e) => {
    warnLog(e);
});

