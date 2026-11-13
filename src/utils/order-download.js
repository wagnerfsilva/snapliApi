'use strict';

const canDownloadOrder = order => ['paid', 'completed', 'courtesy'].includes(order.status);

module.exports = { canDownloadOrder };
