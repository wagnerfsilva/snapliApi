const { Op } = require('sequelize');

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function photoMatchConditions(matches) {
    const externalImageIds = [...new Set(matches.map(match => match.externalImageId)
        .filter(id => id && !id.startsWith('video_')))];
    const photoIds = externalImageIds.filter(id => uuidRegex.test(id));
    const conditions = externalImageIds.flatMap(id => ([
        { originalKey: { [Op.like]: `%/${id}.%` } },
        { originalFilename: { [Op.like]: `${id}.%` } }
    ]));
    if (photoIds.length) conditions.push({ id: { [Op.in]: photoIds } });
    return conditions;
}

module.exports = { photoMatchConditions };
