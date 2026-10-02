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
    const freeCount = Math.max(0, Math.min(event.freePhotosCount || 0, count - 1));
    const paidCount = count - freeCount;
    const packages = (event.videoPricingPackages ?? []).map(pack => ({
        quantity: pack.quantity,
        cents: toCents(pack.price)
    })).sort((first, second) => second.quantity - first.quantity);
    const prices = [paidCount * unit];
    if (packages.length) {
        let remaining = paidCount;
        let packagePrice = 0;
        for (const pack of packages) {
            const uses = Math.floor(remaining / pack.quantity);
            packagePrice += uses * pack.cents;
            remaining -= uses * pack.quantity;
        }
        prices.push(packagePrice + remaining * unit);
    }
    if (event.allVideosPrice != null) prices.push(toCents(event.allVideosPrice));
    const totalCents = Math.min(...prices);
    const base = Math.floor(totalCents / paidCount);
    const remainder = totalCents % paidCount;
    return {
        totalCents,
        total: totalCents / 100,
        itemPrices: Array.from({ length: count }, (_, index) => index < freeCount ? 0 : (base + (index - freeCount < remainder ? 1 : 0)) / 100)
    };
}

module.exports = { quoteVideos, validateVideoPricing, toCents };