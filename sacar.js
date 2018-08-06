
// npm install coap --save
const util = require('util');
const fs = require('fs');

const crypto = require('crypto');

const path = require('path');
const mkdirp = require('mkdirp');

const adapter = require('./adapter');
const Messenger = require('./messenger');
const coap = require('./coapdefs');


let fatalLog = console.error;
let traceLog = console.error;
let warnLog = console.error;

//let infoLog = function () { };
let infoLog = console.log;

let outd = 'out';

class MessengerEx extends Messenger {
    constructor() {
        super(...Array.from(arguments));
    }

    queryForID(name, segSize) {
        return new Promise((r, c) => {
            this.sendReq({
                code: coap.POST,
                options: [].concat(this.genUriPaths("rd", segSize)),
                payload: Buffer.from(name),
                callback: (resp) => {
                    infoLog("resp: ", resp.payload.toString());
                    return r(parseInt(resp.payload));
                },
            });
        });
    }

    pushClose(id, info) {
        return new Promise((r, c) => {
            this.sendReq({
                code: coap.POST,
                options: [].concat(this.genUriPaths("done", id)),
                callback: (resp) => r(info),
            });
        });
    }

    queryForSegs(id) {
        return new Promise((r, c) => {
            this.sendReq({
                code: coap.GET,
                options: [].concat(this.genUriPaths("f", id, "segs")),
                callback: (resp) => r([id, parseInt(resp.payload)]),
            });
        });
    }

    queryForHash(id, segs) {
        return new Promise((r, c) => {
            this.sendReq({
                code: coap.GET,
                options: [].concat(this.genUriPaths("f", id, "sha256")),
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
                        r([id,
                            {
                                sha256: hash,
                                pieces: onePiece,
                            },
                        ]);
                    }
                    return;
                }
                let nextIj = ij + conc;
                let p = ij % 2;
                let segIdx = (ij - p) / 2;
                // traceLog("requesting for %d/%d", segIdx, p);
                this.sendReq({
                    code: coap.GET,
                    options: [].concat(this.genUriPaths("f", id, segIdx, p)),
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


function getFile(elSocket, segSize, name, host, port) {
    let msr = new MessengerEx(elSocket, host, port);
    let startTime = new Date();
    let timeCost = 0;
    return msr.queryForID(name, segSize)
        .then((id) => msr.queryForSegs(id))
        .then(([id, segs]) => msr.queryForHash(id, segs))
        .then(([id, segs, hash]) => {
            infoLog("id: ", id);
            infoLog("segs: ", segs);
            infoLog("sha256: ", hash.toString('hex'));
            return msr.queryForContent(id, segs, hash, 1);
        }).then(([id, info]) => msr.pushClose(id, info)
        ).then((info) => {
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
                        return new Date() - startTime;
                    });
            }
            timeCost = new Date() - startTime;
            return msr.close();
        }).then(() => {
            return timeCost;
        });
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

function parseArguments() {
    // main
    let reqName = "<?>";
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
        reqName = args[2];
    }
    let useUDP = process.argv.reduce((p, v) => p |= (v === '-udp'), false);
    return [reqName, elss, elHost, elPort, useUDP];
}

[reqName, theSegmentSize, elHost, elPort, useUDP] = parseArguments();
infoLog("segsize: ", theSegmentSize);
let creator = adapter.createAtSocket;
if (useUDP) {
    creator = adapter.createUDPSocket;
    // console.log("using UDP");
} else {
    // console.log("using AT");
}
creator(
).then((sock) => getFile(sock, theSegmentSize, reqName, elHost, elPort).then((timeCost) => {
    traceLog("time elapsed: ", timeCost);
    console.log("socket closed");
    process.exit(-1);
})).catch((e) => {
    console.error("Any error:", e);
});