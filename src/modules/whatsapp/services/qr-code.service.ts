import { Injectable, Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';
import * as qrcodeTerminal from 'qrcode-terminal';

interface QRGenerationCache {
    qr: string;
    dataUrl: string;
    timestamp: number;
}

@Injectable()
export class QRCodeService {
    private readonly logger = new Logger(QRCodeService.name);
    private readonly qrCache = new Map<string, QRGenerationCache>();
    private readonly QR_CACHE_DURATION = 30000; // 30 seconds

    async generateQR(qr: string): Promise<string> {
        const startTime = Date.now();

        // Check cache first
        const cached = this.qrCache.get(qr);
        if (cached && Date.now() - cached.timestamp < this.QR_CACHE_DURATION) {
            return cached.dataUrl;
        }

        return new Promise((resolve, reject) => {
            QRCode.toDataURL(qr, {
                errorCorrectionLevel: 'M',
                type: 'image/png',
                margin: 1,
                color: { dark: '#000000', light: '#FFFFFF' },
                width: 256,
            }, (err, qrDataUrl) => {
                if (err) {
                    this.logger.error(`❌ QR generation failed: ${err.message}`);
                    reject(err);
                    return;
                }

                this.qrCache.set(qr, { qr, dataUrl: qrDataUrl, timestamp: Date.now() });
                qrcodeTerminal.generate(qr, { small: true });
                this.logger.log(`✅ QR generated in ${Date.now() - startTime}ms`);
                resolve(qrDataUrl);
            });
        });
    }

    clearCache(): void {
        this.qrCache.clear();
    }
}
