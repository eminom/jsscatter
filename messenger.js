

const cp = require('coap-packet');
const crypto = require('crypto');
const coap = require('./coapdefs');

let fatalLog = console.error;
let traceLog = console.error;
let warnLog = console.error;

//let infoLog = function () { };
let infoLog = console.log;

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

        this.sendCount = 0;
        this.resendCount = 0;
        let doSend = (req) => {
            let resChunk = cp.generate(req);
            this.sendCount++;
            usock.send(resChunk, port, host, (err) => {
                if (err) {
                    fatalLog("Error:", err);
                    process.exit(5);
                    return;
                }
            });
        };

        this.close = () => {
            return new Promise((r, c) => {
                usock.close(() => r());
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
                //warnLog("resent one");
                this.resendCount++; // full scope
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

    genUriPaths() {
        let rv = [];
        let args = Array.from(arguments);
        for (let i = 0; i < args.length; ++i) {
            rv.push({ name: "Uri-Path", value: Buffer.from(args[i].toString()) });
        }
        return rv;
    }


    doReport() {
        infoLog("send (" + this.sendCount.toString() + ") in all");
        infoLog("resend (" + this.resendCount.toString() + ")");
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

module.exports = Messenger;