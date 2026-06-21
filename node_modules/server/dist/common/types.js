"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoupState = exports.SecsStreamFunction = exports.SecsMessageType = void 0;
var SecsMessageType;
(function (SecsMessageType) {
    SecsMessageType[SecsMessageType["DATA_MESSAGE"] = 0] = "DATA_MESSAGE";
    SecsMessageType[SecsMessageType["SELECT_REQ"] = 1] = "SELECT_REQ";
    SecsMessageType[SecsMessageType["SELECT_RSP"] = 2] = "SELECT_RSP";
    SecsMessageType[SecsMessageType["DESELECT_REQ"] = 3] = "DESELECT_REQ";
    SecsMessageType[SecsMessageType["DESELECT_RSP"] = 4] = "DESELECT_RSP";
    SecsMessageType[SecsMessageType["LINKTEST_REQ"] = 5] = "LINKTEST_REQ";
    SecsMessageType[SecsMessageType["LINKTEST_RSP"] = 6] = "LINKTEST_RSP";
    SecsMessageType[SecsMessageType["REJECT_REQ"] = 7] = "REJECT_REQ";
    SecsMessageType[SecsMessageType["SEPARATE_REQ"] = 9] = "SEPARATE_REQ";
})(SecsMessageType || (exports.SecsMessageType = SecsMessageType = {}));
var SecsStreamFunction;
(function (SecsStreamFunction) {
    SecsStreamFunction["S6F11"] = "S6F11";
    SecsStreamFunction["S6F12"] = "S6F12";
    SecsStreamFunction["S1F1"] = "S1F1";
    SecsStreamFunction["S1F2"] = "S1F2";
    SecsStreamFunction["S1F13"] = "S1F13";
    SecsStreamFunction["S1F14"] = "S1F14";
})(SecsStreamFunction || (exports.SecsStreamFunction = SecsStreamFunction = {}));
var FoupState;
(function (FoupState) {
    FoupState["EMPTY"] = "EMPTY";
    FoupState["LOADED"] = "LOADED";
    FoupState["PICKING"] = "PICKING";
    FoupState["PLACING"] = "PLACING";
})(FoupState || (exports.FoupState = FoupState = {}));
//# sourceMappingURL=types.js.map