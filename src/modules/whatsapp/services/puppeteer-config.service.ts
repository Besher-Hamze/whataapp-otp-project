import { Injectable } from '@nestjs/common';

@Injectable()
export class PuppeteerConfigService {
    getConfig() {
        return {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI,VizDisplayCompositor',
                '--disable-ipc-flooding-protection',
                '--disable-extensions',
                '--disable-default-apps',
                '--disable-sync',
                '--metrics-recording-only',
                '--no-default-browser-check',
                '--mute-audio',
                '--no-crash-upload',
                '--disable-background-networking',
                '--disable-component-update',
                '--disable-domain-reliability',
                '--disable-features=AudioServiceOutOfProcess',
                '--single-process',
                '--memory-pressure-off',
                '--max_old_space_size=4096',
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            timeout: 60000,
            protocolTimeout: 60000,
        };
    }
}
