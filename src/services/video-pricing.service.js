'use strict';

function toCents(value) {
    const text = String(value ?? '');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        throw new Error('Preco de video deve ser positivo e ter no maximo duas casas decimais');
    }
    const cents = Math.round(Number(text) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 9999999999) {
        throw new Error('Preco de video invalido');
    }
    return cents;
}

function validateVideoPricing(event) {
    if (typeof event.videoEnabled !== 'boolean') throw new Error('videoEnabled deve ser booleano');
    if (event.videoEnabled || event.pricePerVideo != null) toCents(event.pricePerVideo);
    if (event.allVideosPrice != null) toCents(event.allVideosPrice);
    const packages = event.videoPricingPackages ?? [];
    if (!Array.isArray(packages) || packages.length > 100) throw new Error('Pacotes de video invalidos');
    for (const pack of packages) {
        if (!pack || !Number.isInteger(pack.quantity) || pack.quantity < 1 || pack.quantity > 1000) {
            throw new Error('Quantidade do pacote de video deve ser inteira entre 1 e 1000');
        }
        toCents(pack.price);
    }
}

function quoteVideos(count, event) {
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
        throw new Error('Selecione entre 1 e 1000 videos');
    }
    validateVideoPricing(event);
    if (!event.videoEnabled) throw new Error('Venda de videos desabilitada neste evento');
    const unit = toCents(event.pricePerVideo);
    const packages = (event.videoPricingPackages ?? []).map(pack => ({
        quantity: pack.quantity,
        cents: toCents(pack.price)
    }));
    const costs = Array(count + 1).fill(Infinity);
    costs[0] = 0;
    for (let quantity = 1; quantity <= count; quantity++) {
        costs[quantity] = costs[quantity - 1] + unit;
        for (const pack of packages) {
            if (pack.quantity <= quantity) {
                costs[quantity] = Math.min(costs[quantity], costs[quantity - pack.quantity] + pack.cents);
            }
        }
    }
    const totalCents = Math.min(costs[count], event.allVideosPrice == null ? Infinity : toCents(event.allVideosPrice));
    const base = Math.floor(totalCents / count);
    const remainder = totalCents % count;
    return {
        totalCents,
        total: totalCents / 100,
        itemPrices: Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100)
    };
}

module.exports = { quoteVideos, validateVideoPricing, toCents };