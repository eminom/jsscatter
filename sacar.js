
// npm install coap --save
const util = require('util');
const fs = require('fs');
const cp = require('coap-packet');
const crypto = require('crypto');
const coap = require('./coapdefs');
const path = require('path');
const mkdirp = require('mkdirp');

const adapter = require('./adapter');

let fatalLog = console.error;
let traceLog = console.error;
let warnLog = console.error;

let debugLog = function () { };

let outd = 'out';

class Messenger {
    constructor(usock, host, port) {
        usock.on('message', (msg) => {
            let resp = cp.parse(msg);
            switch (getTypeOfResp(resp)) {
                case coap.Acknowledgement:
                    let sig = this._getSig(resp);
                    let req = this._msgMap[sig];
                    if (req) {
                        setTimeout(() => req.callback(resp), 0);
                        this._removeFromArray(req);
                    }
                    delete this._msgMap[sig];
                    break;
                case coap.Confirmable:
                case coap.NonConfirmable:
                    throw new Error("not implemented");
                case coap.Reset:
                    throw new Error("RESET!");
            }
        });
        let doSend = (req) => {
            let resChunk = cp.generate(req);
            usock.send(resChunk, port, host, (err) => {
                if (err) {
                    fatalLog("Error:", err);
                    process.exit(5);
                    return;
                }
            });
        };

        this._msgMap = {};
        this.elMsgID = 1000;
        this._doSend = doSend;
        this._reqs = [];
        this._timer = setInterval(() => this._checkBox(), 5000);
    }

    _removeFromArray(req) {
        for (let i = 0; i < this._reqs.length; ++i) {
            if (this._reqs[i] == req) {
                this._reqs.splice(i, 1);
                return;
            }
        }
        warnLog("not remove from array ??");
    }

    _checkBox() {
        let now = new Date();
        for (let i = 0; i < this._reqs.length;) {
            let that = this._reqs[i];
            if (now - that._lastSent >= 5000) {
                if (that._sentCount >= 3) {
                    warnLog("timeout");
                    delete this._msgMap[this._getSig(that)];
                    this._reqs.splice(i, 1);
                    process.exit(1);
                    continue;
                }
                warnLog("resent one");
                that._sentCount++;
                this._doSend(that);
            }
            ++i;
        }
    }

    _getNextMessageID() {
        this.elMsgID = (1 + this.elMsgID) % 65536;
        return this.elMsgID;
    }

    sendReq(req) {
        let sig = '';
        while (1) {
            req.messageId = this._getNextMessageID();
            req.token = crypto.randomBytes(8);
            sig = this._getSig(req);
            if (this._msgMap.hasOwnProperty(sig)) {
                warnLog("critical error!!!!");
            } else {
                break;
            }
        }
        req = coap.NewReq(req);
        req._lastSent = new Date; // to be sent immediately.
        req._sentCount = 1;
        // the same reference.
        this._msgMap[sig] = req;
        this._reqs.push(req);
        this._doSend(req);
    }

    _getSig(msg) {
        return msg.token.toString('hex') + ":" + msg.messageId.toString();
    }
}

class MessengerEx extends Messenger {
    constructor() {
        super(...Array.from(arguments));
    }


    queryForID(name) {
        return new Promise((r, c) => {
            this.sendReq({
                code: coap.POST,
                options: [].concat(genUriPaths("rd", "placeholder")),
                payload: Buffer.from(name),
                callback: (resp) => r(parseInt(resp.payload)),
            });
        });
    }

    queryForSegs(id) {
        return new Promise((r, c) => {
            this.sendReq({
                code: coap.GET,
                options: [].concat(genUriPaths("f", id, "segs")),
                callback: (resp) => r([id, parseInt(resp.payload)]),
            });
        });
    }

    queryForHash(id, segs) {
        return new Promise((r, c) => {
            this.sendReq({
                code: coap.GET,
                options: [].concat(genUriPaths("f", id, "sha256")),
                callback: (resp) => r([id, segs, resp.payload]),
            })
        });
    }

    queryForContent(id, segs, hash, conc) {
        let whatsleft = conc;
        let onePiece = [];
        for (let i = 0; i < segs; ++i) {
            onePiece[i] = [];
        }
        return new Promise((r, c) => {
            let reqForOne = (ij) => {
                if (ij >= segs * 2) {
                    whatsleft--;
                    if (whatsleft == 0) {
                        r({
                            sha256: hash,
                            pieces: onePiece,
                        });
                    }
                    return;
                }
                let nextIj = ij + conc;
                let p = ij % 2;
                let segIdx = (ij - p) / 2;
                // traceLog("requesting for %d/%d", segIdx, p);
                this.sendReq({
                    code: coap.GET,
                    options: [].concat(genUriPaths("f", id, segIdx, p)),
                    callback: (resp) => {
                        onePiece[segIdx][p] = resp.payload;
                        reqForOne(nextIj);
                    },
                });
            };
            for (let i = 0; i < conc; ++i) {
                reqForOne(i);
            }
        })
    }
}

function getTypeOfResp(resp) {
    if (resp.confirmable) {
        return coap.Confirmable;
    } else if (resp.reset) {
        return coap.Reset;
    } else if (resp.ack) {
        return coap.Acknowledgement;
    }
    return coap.NonConfirmable;
}


function getFile(elSocket, name, host, port) {
    let msr = new MessengerEx(elSocket, host, port);
    let startTime = new Date();
    return msr.queryForID(name)
        .then((id) => msr.queryForSegs(id))
        .then(([id, segs]) => msr.queryForHash(id, segs))
        .then(([id, segs, hash]) => {
            debugLog("id: ", id);
            debugLog("segs: ", segs);
            debugLog("sha256: ", hash.toString('hex'));
            return msr.queryForContent(id, segs, hash, 4);
        }).then((info) => {
            switch (name) {
                case "<?>":
                    let ob = Buffer.alloc(0);
                    // traceLog("piece count: ", info.pieces.length);
                    let content = Buffer.concat(info.pieces.reduce((p, v) => p.concat(v[1]), []));
                    let hashed = crypto.createHash("sha256").update(content).digest('hex');
                    if (hashed !== info.sha256.toString('hex')) {
                        warnLog("recv: ", hashed);
                        warnLog("expected: ", info.sha256.toString('hex'));
                    } else {
                        process.stdout.write(content);
                    }
                    break;
                default:
                    let fullpath = path.join(outd, name);
                    let tmpName = fullpath + ".sacartmp";
                    let mkdir = util.promisify(mkdirp);
                    let open = util.promisify(fs.open);
                    let rename = util.promisify(fs.rename);
                    let unlink = util.promisify(fs.unlink);
                    return mkdir(path.dirname(fullpath), 0777
                    ).then(() => open(tmpName, "w")
                    ).then(fd => writeToFile(fd, info)
                    ).then(() => verifyFile(tmpName, info.sha256)
                    ).then((ok) => {
                        // traceLog("VERIFY: ", ok);
                        if (ok) {
                            return rename(tmpName, fullpath);
                        }
                        warnLog("verification failed.");
                        return unlink(tmpName);
                    }).then(() => {
                        return startTime;
                    });
            }
            return startTime;
        });
}

function genUriPaths() {
    let rv = [];
    let args = Array.from(arguments);
    for (let i = 0; i < args.length; ++i) {
        rv.push({ name: "Uri-Path", value: Buffer.from(args[i].toString()) });
    }
    return rv;
}

function writeToFile(fd, info) {
    return new Promise((r, c) => {
        let total = info.pieces.length;
        let writeOne = (idx) => {
            if (idx >= total) {
                fs.close(fd, (err) => {
                    if (err) {
                        fatalLog(err);
                        c(err);
                        return
                    }
                    r();
                });
                return;
            }
            fs.write(fd, info.pieces[idx][1], (err) => {
                if (err) {
                    fatalLog(err);
                    return;
                }
                writeOne(idx + 1);
            });
        };
        writeOne(0);
    });
}

function verifyFile(name, hash) {
    let open = util.promisify(fs.open);
    let h = crypto.createHash('sha256');
    return new Promise((r, c) => {
        open(name, "r"
        ).then(fd => {
            let buffer = Buffer.alloc(64 * 1024);
            let readOnce = () => {
                fs.read(fd, buffer, 0, buffer.length, null, (err, bytesRead, buf) => {
                    // traceLog("site 1", err, bytesRead, buf);
                    if (err) {
                        fatalLog(err);
                        c(err);
                        return;
                    }
                    if (0 === bytesRead) {
                        // traceLog("verifying done");
                        fs.close(fd, (err) => {
                            if (err) {
                                fatalLog("close error:", err);
                                return;
                            }
                            r(0 == Buffer.compare(h.digest(), hash));
                        });
                        return;
                    }
                    h.update(buf.slice(0, bytesRead));
                    readOnce();
                });
            };
            readOnce();
        }).catch(e => c(e));
    });
}

// main
let reqName = "<?>";
let elHost = "172.16.53.182";
let elPort = 16666;
let args = process.argv.reduce((p, v) => {
    if (/[\w\d\.]+:\d+/.test(v)) {
        [elHost, elPort] = v.split(":");
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
    reqName = args[2];
}
let useUDP = process.argv.reduce((p, v) => p |= (v === '-udp'), false);
let creator = adapter.createAtSocket;
if (useUDP) {
    creator = adapter.createUDPSocket;
    // console.log("using UDP");
} else {
    // console.log("using AT");
}
creator(
).then((sock) =>
    getFile(sock, reqName, elHost, elPort).then((s) => {
        traceLog("time elapsed: ", new Date() - s);
        process.exit(0);
    })
).catch((e) => {
    console.error("Any error:", e);
});