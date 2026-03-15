import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private resend: Resend;

    constructor() {
        // Fallback to empty string to prevent crash if not set, 
        // will just log an error when attempting to send
        this.resend = new Resend(process.env.RESEND_API_KEY || '');
    }

    async sendOtpEmail(email: string, otp: string, name: string) {
        try {
            const { data, error } = await this.resend.emails.send({
                from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
                to: process.env.OVERRIDE_EMAIL || email, // Override: Send all OTPs here
                subject: 'Your Verification Code',
                html: `
          <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h2>Welcome, ${name}!</h2>
            <p>Your one-time verification code is:</p>
            <h1 style="letter-spacing: 4px; color: #000; background: #f4f4f5; padding: 12px 24px; display: inline-block; border-radius: 8px;">
              ${otp}
            </h1>
            <p>This code will expire in 2 minutes.</p>
            <p>If you did not request this code, you can safely ignore this email.</p>
          </div>
        `,
            });

            if (error) {
                this.logger.error(`Failed to send OTP to ${email}: ${error.message}`);
                return false;
            }

            this.logger.log(`OTP sent successfully to ${email}`);
            return true;
        } catch (err: any) {
            this.logger.error(`Failed to send OTP to ${email}: ${err.message}`);
            return false;
        }
    }
}
