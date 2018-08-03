
const fs = require('fs');
const util = require('util');
const crypto = require('crypto');


let fatalLog = console.error;
let traceLog = console.error;
let warnLog = console.error;

//let infoLog = function () { };
let infoLog = console.log;

class Fragger {
    constructor(pathname, chunksize, totalCount) {
        this.pathname = pathname;
        this.chunksize = chunksize;
        this.totalCount = totalCount;
        this.cbs = {};
    }

    get filename() {
        return this.pathname;
    }

    startRead() {
        let open = util.promisify(fs.open);
        let hash = crypto.createHash('sha256');
        return new Promise((r, c) => {
            open(this.pathname, 'r'
            ).then(fd => {
                let buf = Buffer.alloc(this.chunksize);
                let idx = 0;
                let readOnce = (onData, onEnd, onErr) => {
                    fs.read(fd, buf, 0, buf.length, null, (err, bytesRead, _) => {
                        if (err) {
                            fatalLog("error reading:", err);
                            onErr(err);
                            return;
                        }
                        if (0 == bytesRead) {
                            let hashed = hash.digest();
                            let lbuff = Buffer.alloc(4);
                            lbuff.writeInt32BE(this.totalCount);
                            let h2 = crypto.createHash('sha1').update(hashed).update(lbuff).digest().slice(0, 6);
                            onEnd(Buffer.concat([hashed, lbuff, h2]));
                            return;
                        }
                        let slice = buf.slice(0, bytesRead);
                        hash.update(slice);
                        let sig = genSigForChunk(slice);
                        onData(slice, sig, idx);
                        idx++;
                    });
                };
                r(readOnce);
            });
        });
    }
};

function genSigForChunk(chunk) {
    let md5 = crypto.createHash('md5');
    md5.update(chunk);
    let md5buff = md5.digest();
    let lbuf = Buffer.alloc(2);
    lbuf.writeUInt16BE(chunk.length);
    let sa1 = crypto.createHash('sha1');
    sa1.update(md5buff);
    sa1.update(lbuf);
    return Buffer.concat([md5buff, lbuf, sa1.digest().slice(0, 6)]);
}

function createFragger(pathname, chunksize) {
    return new Promise((r, c) => {
        let stat = util.promisify(fs.stat);
        stat(pathname
        ).then((s) => {
            let chunkCount = Math.floor((s.size + (chunksize - 1)) / chunksize);
            r(new Fragger(pathname, chunksize, chunkCount));
        });
    });
}

module.exports = createFragger;
