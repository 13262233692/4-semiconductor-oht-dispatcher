"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const hsms_module_1 = require("./hsms/hsms.module");
const state_buffer_module_1 = require("./state-buffer/state-buffer.module");
const routing_module_1 = require("./routing/routing.module");
const websocket_module_1 = require("./websocket/websocket.module");
const simulator_module_1 = require("./simulator/simulator.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '.env',
            }),
            hsms_module_1.HsmsModule,
            state_buffer_module_1.StateBufferModule,
            routing_module_1.RoutingModule,
            websocket_module_1.WebsocketModule,
            simulator_module_1.SimulatorModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map