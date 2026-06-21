"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const common_1 = require("@nestjs/common");
async function bootstrap() {
    const logger = new common_1.Logger('Bootstrap');
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        cors: {
            origin: '*',
            credentials: true,
        },
    });
    const httpPort = parseInt(process.env.HTTP_PORT || '3000', 10);
    const tcpPort = parseInt(process.env.TCP_PORT || '5000', 10);
    await app.listen(httpPort);
    logger.log(`HTTP/WebSocket Server running on http://localhost:${httpPort}`);
    logger.log(`HSMS TCP Server listening on port ${tcpPort}`);
}
bootstrap();
//# sourceMappingURL=main.js.map