const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
    constructor() {
        // Configure transporter
        // For development, use ethereal.email or console
        // For production, configure with real SMTP
        this.transporter = this.createTransporter();
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

            const mailOptions = {
                from: process.env.SMTP_FROM || 'noreply@fotow.com',
                to: order.customerEmail,
                subject: '📸 Suas fotos estão prontas para download - Fotow',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2563eb;">Obrigado pela sua compra! 🎉</h2>
                        
                        <p>Olá <strong>${order.customerName}</strong>,</p>
                        
                        <p>Seu pagamento foi confirmado e suas fotos já estão disponíveis para download!</p>
                        
                        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <p style="margin: 0;"><strong>Pedido:</strong> #${order.id.substring(0, 8)}</p>
                            <p style="margin: 10px 0 0 0;"><strong>Total:</strong> R$ ${parseFloat(order.totalAmount).toFixed(2)}</p>
                            <p style="margin: 10px 0 0 0;"><strong>Fotos:</strong> ${order.items?.length || 0}</p>
                        </div>
                        
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${downloadUrl}" 
                               style="background-color: #2563eb; color: white; padding: 14px 28px; 
                                      text-decoration: none; border-radius: 6px; display: inline-block;
                                      font-weight: bold;">
                                Baixar Minhas Fotos
                            </a>
                        </div>
                        
                        <p style="color: #6b7280; font-size: 14px;">
                            ⏰ <strong>Importante:</strong> Este link estará disponível até 
                            ${new Date(order.downloadExpiresAt).toLocaleDateString('pt-BR')}
                        </p>
                        
                        <p style="color: #6b7280; font-size: 14px;">
                            💾 Você pode baixar suas fotos quantas vezes quiser durante este período.
                        </p>
                        
                        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                        
                        <p style="color: #9ca3af; font-size: 12px;">
                            Link direto: <a href="${downloadUrl}" style="color: #2563eb;">${downloadUrl}</a>
                        </p>
                        
                        <p style="color: #9ca3af; font-size: 12px;">
                            Problemas? Entre em contato conosco.
                        </p>
                    </div>
                `,
                text: `
Obrigado pela sua compra!

Olá ${order.customerName},

Seu pagamento foi confirmado e suas fotos já estão disponíveis para download!

Pedido: #${order.id.substring(0, 8)}
Total: R$ ${parseFloat(order.totalAmount).toFixed(2)}
Fotos: ${order.items?.length || 0}

Acesse suas fotos em: ${downloadUrl}

Este link estará disponível até ${new Date(order.downloadExpiresAt).toLocaleDateString('pt-BR')}

Você pode baixar suas fotos quantas vezes quiser durante este período.
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
                from: process.env.SMTP_FROM || 'noreply@fotow.com',
                to: order.customerEmail,
                subject: '🛒 Confirmação de Pedido - Fotow',
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
