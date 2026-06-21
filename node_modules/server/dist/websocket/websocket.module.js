"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsocketModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const state_buffer_module_1 = require("../state-buffer/state-buffer.module");
const routing_module_1 = require("../routing/routing.module");
const hsms_module_1 = require("../hsms/hsms.module");
const websocket_gateway_1 = require("./websocket.gateway");
let WebsocketModule = class WebsocketModule {
};
exports.WebsocketModule = WebsocketModule;
exports.WebsocketModule = WebsocketModule = __decorate([
    (0, common_1.Module)({
        imports: [schedule_1.ScheduleModule.forRoot(), state_buffer_module_1.StateBufferModule, routing_module_1.RoutingModule, hsms_module_1.HsmsModule],
        providers: [websocket_gateway_1.WebsocketGateway],
        exports: [websocket_gateway_1.WebsocketGateway],
    })
], WebsocketModule);
//# sourceMappingURL=websocket.module.js.map