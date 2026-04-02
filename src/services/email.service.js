const nodemailer = require('nodemailer');
const sharp = require('sharp');
const logger = require('../utils/logger');

// SVG do logo Snapli (idêntico ao snapliSite)
const LOGO_SVG = `<svg width="128" height="128" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="16" fill="#C8FF00" />
  <circle cx="32" cy="32" r="18" stroke="#09090B" stroke-width="2.8" fill="none" />
  <circle cx="32" cy="32" r="9" stroke="#09090B" stroke-width="2.8" fill="none" />
  <line x1="32" y1="14" x2="32" y2="23" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="47.6" y1="23" x2="39.8" y2="27.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="47.6" y1="41" x2="39.8" y2="36.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="32" y1="50" x2="32" y2="41" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="16.4" y1="41" x2="24.2" y2="36.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
  <line x1="16.4" y1="23" x2="24.2" y2="27.5" stroke="#09090B" stroke-width="2.2" stroke-linecap="round" />
</svg>`;

class EmailService {
    constructor() {
        // Configure transporter
        // For development, use ethereal.email or console
        // For production, configure with real SMTP
        this.transporter = this.createTransporter();
        this._logoPngBuffer = null;
    }

    /**
     * Gera o PNG do logo a partir do SVG (cache em memória)
     */
    async getLogoPng() {
        if (!this._logoPngBuffer) {
            this._logoPngBuffer = await sharp(Buffer.from(LOGO_SVG))
                .resize(64, 64)
                .png()
                .toBuffer();
        }
        return this._logoPngBuffer;
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

        // Production mode - check if SMTP is configured
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
            logger.warn('SMTP not configured, emails will be logged only');
            return {
                sendMail: async (options) => {
                    logger.info('📧 Email (NO SMTP - PRODUCTION):', {
                        to: options.to,
                        subject: options.subject,
                        text: options.text?.substring(0, 200)
                    });
                    return { messageId: 'no-smtp-' + Date.now() };
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
            }
        });
    }

    /**
     * Send download link email after payment
     */
    async sendDownloadEmail(order) {
        try {
            const downloadUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/downloads/${order.downloadToken}`;
            const photoCount = order.items?.length || 0;
            const expiresDate = new Date(order.downloadExpiresAt).toLocaleDateString('pt-BR');
            const logoPng = await this.getLogoPng();

            const mailOptions = {
                from: process.env.SMTP_FROM || 'Snapli <noreply@snapli.com.br>',
                to: order.customerEmail,
                subject: 'Pagamento Confirmado',
                attachments: [{
                    filename: 'logo.png',
                    content: logoPng,
                    cid: 'snapli-logo'
                }],
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
        <img src="cid:snapli-logo" width="36" height="36" alt="Snapli" style="display: block; border-radius: 10px;" />
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

            await this.transporter.sendMail(mailOptions);
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

            await this.transporter.sendMail(mailOptions);
            logger.info(`Email de confirmação enviado para ${order.customerEmail}`);

            return true;
        } catch (error) {
            logger.error('Erro ao enviar email de confirmação:', error);
            throw error;
        }
    }
}

module.exports = new EmailService();
