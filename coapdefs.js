
function newReq(o) {
    let rv = {
        confirmable: true,
        reset: false,
        ack: false,
    };
    if (typeof (o) === 'object') {
        //Copy
        for (let f in o) {
            rv[f] = o[f];
        }
    }
    return rv;
}

module.exports = {
    Confirmable: 0,
    NonConfirmable: 1,
    Acknowledgement: 2,
    Reset: 3,

    //
    GET: codeSTR(1),
    POST: codeSTR(2),
    PUT: codeSTR(3),
    DELETE: codeSTR(4),

    // Response Code:
    Created: codeSTR(65),
    Deleted: codeSTR(66),
    Valid: codeSTR(67),
    Changed: codeSTR(68),
    Content: codeSTR(69),
    BadRequest: codeSTR(128),
    Unauthorized: codeSTR(129),
    BadOption: codeSTR(130),
    Forbidden: codeSTR(131),
    NotFound: codeSTR(132),
    MethodNotAllowed: codeSTR(133),
    NotAcceptable: codeSTR(134),
    PreconditionFailed: codeSTR(140),
    RequestEntityTooLarge: codeSTR(141),
    UnsupportedMediaType: codeSTR(143),
    InternalServerError: codeSTR(160),
    NotImplemented: codeSTR(161),
    BadGateway: codeSTR(162),
    ServiceUnavailable: codeSTR(163),
    GatewayTimeout: codeSTR(164),
    ProxyingNotSupported: codeSTR(165),


    NewReq: newReq,
};


//For 65: 2.01
//
function codeSTR(v) {
    return Math.floor(v / 32).toString() + '.' + (Math.floor(v % 32 / 10)).toString() + (v % 32 % 10).toString();
}