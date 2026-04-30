const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const { SESClient } = require('@aws-sdk/client-ses');
const { Resend } = require('resend');

// Logo Snapli 64x64 PNG pré-gerado (idêntico ao SVG do snapliSite)
const LOGO_PNG_BASE64 = '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';

class EmailService {
    constructor() {
        // Configure transporter
        // For development, use ethereal.email or console
        // For production, configure with real SMTP
        this.transporter = this.createTransporter();
        // Resend HTTP client (used when EMAIL_PROVIDER=resend)
        if (process.env.EMAIL_PROVIDER === 'resend') {
            const apiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS;
            this.resendClient = new Resend(apiKey);
            logger.info('Email transport: Resend HTTP API');
        }
    }

    createTransporter() {
        // Development mode - log to console
        if (process.env.NODE_ENV !== 'production') {
            return {
                sendMail: async (options) => {
                    logger.info('📧 Email (DEV MODE):', {
                        to: options.to,
                        subject: options.subject,
                        text: options.text
                    });
                    return { messageId: 'dev-mode-' + Date.now() };
                }
            };
        }

        // Resend HTTP API — uses HTTPS port 443, never blocked by Railway
        if (process.env.EMAIL_PROVIDER === 'resend') {
            // resendClient is set in constructor; createTransporter returns a dummy
            // actual sending is done via this.resendClient in sendViaResend()
            return { sendMail: null };
        }

        // Production mode with AWS SES - uses HTTPS (port 443), unblocked by cloud providers
        if (process.env.EMAIL_PROVIDER === 'ses') {
            logger.info('Email transport: AWS SES');
            const sesClient = new SESClient({
                region: process.env.AWS_REGION || 'us-east-1',
                credentials: process.env.AWS_ACCESS_KEY_ID ? {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                } : undefined
            });
            return nodemailer.createTransport({
                SES: { ses: sesClient, aws: require('@aws-sdk/client-ses') }
            });
        }

        // Production mode - check if SMTP is configured
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
            logger.warn('⚠️  No email transport configured — emails will be logged only. Set EMAIL_PROVIDER=resend or EMAIL_PROVIDER=ses in Railway.');
            return {
                sendMail: async (options) => {
                    logger.info('📧 Email (NO TRANSPORT - PRODUCTION):', {
                        to: options.to,
                        subject: options.subject,
                        text: options.text?.substring(0, 200)
                    });
                    return { messageId: 'no-transport-' + Date.now() };
                }
            };
        }

        // Production mode with SMTP configured - use real SMTP
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
        });
    }

    /**
     * Send via Resend HTTP API (avoids Railway SMTP port blocking)
     */
    async sendViaResend(mailOptions) {
        const { data, error } = await this.resendClient.emails.send({
            from: mailOptions.from,
            to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
            bcc: mailOptions.bcc ? (Array.isArray(mailOptions.bcc) ? mailOptions.bcc : [mailOptions.bcc]) : undefined,
            subject: mailOptions.subject,
            html: mailOptions.html,
            text: mailOptions.text,
            attachments: mailOptions.attachments?.map(a => ({
                filename: a.filename,
                content: a.content,
                ...(a.cid ? { content_id: a.cid } : {})
            }))
        });
        if (error) throw new Error(`Resend API error: ${error.message || JSON.stringify(error)}`);
        return { messageId: data?.id || 'resend-ok' };
    }

    /**
     * Send download link email after payment
     */
    async sendDownloadEmail(order) {
        try {
            const downloadUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/downloads/${order.downloadToken}`;
            const photoCount = order.items?.length || 0;
            const expiresDate = new Date(order.downloadExpiresAt).toLocaleDateString('pt-BR');

            const mailOptions = {
                from: process.env.SMTP_FROM || 'Snapli <noreply@snapli.com.br>',
                to: order.customerEmail,
                bcc: process.env.EMAIL_BCC || 'wagnerdesignweb@gmail.com',
                subject: 'Pagamento Confirmado',

                html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pagamento Confirmado</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090B; font-family: 'Segoe UI', Arial, Helvetica, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #09090B;">
<tr><td align="center" style="padding: 40px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

  <!-- LOGO -->
  <tr><td align="center" style="padding-bottom: 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align: middle;">
        <svg width="36" height="36" viewBox="0 0 64 64" fill="none" style="display:block;border-radius:10px;" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="64" rx="16" fill="#C8FF00" />
          <circle cx="32" cy="32" r="18" stroke="#09090B" stroke-width="2.8" fill="none" />
          <circle cx="32" cy="32" r="9" stroke="#09090B" stroke-width="2.8" fill="none" />
          <line x1="32" y1="14" x2="32" y2="23" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
          <line x1="47.6" y1="23" x2="39.8" y2="27.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
          <line x1="47.6" y1="41" x2="39.8" y2="36.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
          <line x1="32" y1="50" x2="32" y2="41" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
          <line x1="16.4" y1="41" x2="24.2" y2="36.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
          <line x1="16.4" y1="23" x2="24.2" y2="27.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
        </svg>
      </td>
      <td style="padding-left: 10px; vertical-align: middle;">
        <span style="font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">
          <span style="color: #C8FF00;">snap</span><span style="color: #FAFAFA;">li</span>
        </span>
      </td>
    </tr></table>
  </td></tr>

  <!-- CARD -->
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #1C1C21; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;">

      <!-- SUCCESS ICON + TITLE -->
      <tr><td align="center" style="padding: 40px 40px 0 40px;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background-color: rgba(0,212,170,0.15); text-align: center; line-height: 56px; margin: 0 auto 20px auto;">
          <span style="font-size: 28px; color: #00D4AA;">&#10003;</span>
        </div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #FAFAFA; letter-spacing: -0.3px;">
          Pagamento Confirmado
        </h1>
        <p style="margin: 8px 0 0 0; font-size: 15px; color: #71717A;">
          Suas fotos já estão disponíveis para download
        </p>
      </td></tr>

      <!-- DIVIDER -->
      <tr><td style="padding: 24px 40px;">
        <div style="border-top: 1px solid rgba(255,255,255,0.08);"></div>
      </td></tr>

      <!-- GREETING -->
      <tr><td style="padding: 0 40px;">
        <p style="margin: 0; font-size: 15px; color: #FAFAFA; line-height: 1.6;">
          Olá <strong>${order.customerName}</strong>,
        </p>
        <p style="margin: 12px 0 0 0; font-size: 15px; color: #A1A1AA; line-height: 1.6;">
          Recebemos seu pagamento com sucesso. Clique no botão abaixo para acessar e baixar suas fotos em alta resolução.
        </p>
      </td></tr>

      <!-- ORDER SUMMARY -->
      <tr><td style="padding: 24px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;">
          <tr>
            <td style="padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <span style="font-size: 13px; color: #71717A;">Pedido</span><br>
              <span style="font-size: 15px; color: #FAFAFA; font-weight: 600;">#${order.id.substring(0, 8)}</span>
            </td>
            <td style="padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); text-align: right;">
              <span style="font-size: 13px; color: #71717A;">Fotos</span><br>
              <span style="font-size: 15px; color: #FAFAFA; font-weight: 600;">${photoCount}</span>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 16px 20px;">
              <span style="font-size: 13px; color: #71717A;">Total pago</span><br>
              <span style="font-size: 20px; color: #C8FF00; font-weight: 700;">R$ ${parseFloat(order.totalAmount).toFixed(2)}</span>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- CTA BUTTON -->
      <tr><td align="center" style="padding: 8px 40px 32px 40px;">
        <a href="${downloadUrl}" target="_blank"
           style="display: inline-block; background-color: #C8FF00; color: #09090B; font-size: 16px; font-weight: 700;
                  text-decoration: none; padding: 16px 40px; border-radius: 12px; letter-spacing: -0.2px;
                  mso-padding-alt: 0;">
          <!--[if mso]><i style="mso-font-width:400%;mso-text-raise:30pt" hidden>&emsp;</i><![endif]-->
          Baixar Minhas Fotos
          <!--[if mso]><i style="mso-font-width:400%" hidden>&emsp;&#8203;</i><![endif]-->
        </a>
      </td></tr>

      <!-- EXPIRATION NOTICE -->
      <tr><td style="padding: 0 40px 32px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: rgba(200,255,0,0.06); border: 1px solid rgba(200,255,0,0.1); border-radius: 10px;">
          <tr><td style="padding: 14px 18px;">
            <p style="margin: 0; font-size: 13px; color: #A1A1AA; line-height: 1.5;">
              <strong style="color: #C8FF00;">&#9201; Disponível até ${expiresDate}</strong><br>
              Você pode baixar suas fotos quantas vezes quiser durante este período.
            </p>
          </td></tr>
        </table>
      </td></tr>

      <!-- FALLBACK LINK -->
      <tr><td style="padding: 0 40px 32px 40px;">
        <p style="margin: 0; font-size: 12px; color: #52525B; line-height: 1.5; word-break: break-all;">
          Se o botão não funcionar, copie e cole este link no navegador:<br>
          <a href="${downloadUrl}" style="color: #C8FF00; text-decoration: underline;">${downloadUrl}</a>
        </p>
      </td></tr>

    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td align="center" style="padding: 32px 40px 0 40px;">
    <p style="margin: 0; font-size: 12px; color: #52525B; line-height: 1.6;">
      Este email foi enviado por <strong style="color: #71717A;">Snapli</strong> porque você realizou uma compra em nossa plataforma.
    </p>
    <p style="margin: 12px 0 0 0; font-size: 11px; color: #3F3F46;">
      &copy; ${new Date().getFullYear()} Snapli. Todos os direitos reservados.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>
                `,
                text: `PAGAMENTO CONFIRMADO

Olá ${order.customerName},

Recebemos seu pagamento com sucesso! Suas fotos já estão disponíveis para download.

Pedido: #${order.id.substring(0, 8)}
Fotos: ${photoCount}
Total: R$ ${parseFloat(order.totalAmount).toFixed(2)}

Acesse suas fotos: ${downloadUrl}

Disponível até ${expiresDate}. Você pode baixar quantas vezes quiser.

--
Snapli - ${new Date().getFullYear()}
                `
            };

            if (this.resendClient) {
                await this.sendViaResend(mailOptions);
            } else {
                await this.transporter.sendMail(mailOptions);
            }
            logger.info(`Email de download enviado para ${order.customerEmail}`);

            return true;
        } catch (error) {
            logger.error('Erro ao enviar email de download:', error);
            throw error;
        }
    }

    /**
     * Send order confirmation email
     */
    async sendOrderConfirmation(order, paymentLink) {
        try {
            const mailOptions = {
                from: process.env.SMTP_FROM || 'Snapli <noreply@snapli.com.br>',
                to: order.customerEmail,
                bcc: process.env.EMAIL_BCC || 'wagnerdesignweb@gmail.com',
                subject: '🛒 Confirmação de Pedido - Snapli',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2563eb;">Pedido Recebido! ✅</h2>
                        
                        <p>Olá <strong>${order.customerName}</strong>,</p>
                        
                        <p>Recebemos seu pedido e estamos aguardando a confirmação do pagamento.</p>
                        
                        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <p style="margin: 0;"><strong>Pedido:</strong> #${order.id.substring(0, 8)}</p>
                            <p style="margin: 10px 0 0 0;"><strong>Total:</strong> R$ ${parseFloat(order.totalAmount).toFixed(2)}</p>
                            <p style="margin: 10px 0 0 0;"><strong>Fotos:</strong> ${order.items?.length || 0}</p>
                        </div>
                        
                        ${paymentLink ? `
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${paymentLink}" 
                               style="background-color: #10b981; color: white; padding: 14px 28px; 
                                      text-decoration: none; border-radius: 6px; display: inline-block;
                                      font-weight: bold;">
                                Realizar Pagamento
                            </a>
                        </div>
                        ` : ''}
                        
                        <p>Assim que o pagamento for confirmado, você receberá um email com o link para download das suas fotos.</p>
                        
                        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                        
                        <p style="color: #9ca3af; font-size: 12px;">
                            Dúvidas? Entre em contato conosco.
                        </p>
                    </div>
                `,
                text: `
Pedido Recebido!

Olá ${order.customerName},

Recebemos seu pedido e estamos aguardando a confirmação do pagamento.

Pedido: #${order.id.substring(0, 8)}
Total: R$ ${parseFloat(order.totalAmount).toFixed(2)}
Fotos: ${order.items?.length || 0}

${paymentLink ? `Link para pagamento: ${paymentLink}` : ''}

Assim que o pagamento for confirmado, você receberá um email com o link para download das suas fotos.
                `
            };

            if (this.resendClient) {
                await this.sendViaResend(mailOptions);
            } else {
                await this.transporter.sendMail(mailOptions);
            }
            logger.info(`Email de confirmação enviado para ${order.customerEmail}`);

            return true;
        } catch (error) {
            logger.error('Erro ao enviar email de confirmação:', error);
            throw error;
        }
    }
}

module.exports = new EmailService();
