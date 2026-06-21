"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulatorModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const state_buffer_module_1 = require("../state-buffer/state-buffer.module");
const routing_module_1 = require("../routing/routing.module");
const oht_simulator_service_1 = require("./oht-simulator.service");
let SimulatorModule = class SimulatorModule {
};
exports.SimulatorModule = SimulatorModule;
exports.SimulatorModule = SimulatorModule = __decorate([
    (0, common_1.Module)({
        imports: [schedule_1.ScheduleModule.forRoot(), state_buffer_module_1.StateBufferModule, routing_module_1.RoutingModule],
        providers: [oht_simulator_service_1.OhtSimulatorService],
        exports: [oht_simulator_service_1.OhtSimulatorService],
    })
], SimulatorModule);
//# sourceMappingURL=simulator.module.js.map