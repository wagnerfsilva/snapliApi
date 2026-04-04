#!/usr/bin/env node
/**
 * Envia email de teste para um pedido existente
 * Uso: node scripts/test/send-test-email.js <orderId-parcial>
 */
require('dotenv').config();
const { Order, OrderItem } = require('../../src/models');
const emailService = require('../../src/services/email.service');
const nodemailer = require('nodemailer');
const { Op } = require('sequelize');

(async () => {
    try {
        const partialId = process.argv[2];
        if (!partialId) {
            console.error('Uso: node scripts/test/send-test-email.js <orderId-parcial>');
            process.exit(1);
        }

        const { Sequelize } = require('sequelize');

        const orders = await Order.findAll({
            where: Sequelize.where(
                Sequelize.cast(Sequelize.col('Order.id'), 'text'),
                { [Sequelize.Op.like]: `${partialId}%` }
            ),
            include: [{ model: OrderItem, as: 'items' }]
        });

        if (orders.length === 0) {
            console.error('Nenhum pedido encontrado com ID:', partialId);
            process.exit(1);
        }

        const order = orders[0];
        console.log('Pedido encontrado:', {
            id: order.id,
            status: order.status,
            email: order.customerEmail,
            nome: order.customerName,
            token: order.downloadToken ? order.downloadToken.substring(0, 8) + '...' : 'N/A',
            paidAt: order.paidAt,
            total: order.totalAmount,
            fotos: order.items?.length || 0
        });

        // Força usar SMTP real (override dev mode)
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
            emailService.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
            console.log('Usando SMTP real:', process.env.SMTP_HOST);
        }

        console.log('Enviando email para:', order.customerEmail);
        await emailService.sendDownloadEmail(order);
        console.log('Email enviado com sucesso!');

        process.exit(0);
    } catch (error) {
        console.error('Erro:', error.message);
        process.exit(1);
    }
})();
