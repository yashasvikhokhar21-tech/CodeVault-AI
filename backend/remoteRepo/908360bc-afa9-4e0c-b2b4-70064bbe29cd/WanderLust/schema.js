const Joi = require('joi');

module.exports.listingSchema = Joi.object({
    listing: Joi.object({
        title: Joi.string().required(),
        price: Joi.number().required().min(0),
        description: Joi.string().required(),
        country: Joi.string().required(),
        location: Joi.string().required(),
        // Accept either a nested image object or a simple URL string.
        // If a string is provided by the form, we'll normalize it on the server
        // before saving. If missing, we set a default object.
        image: Joi.alternatives()
            .try(
                Joi.object({
                    filename: Joi.string().allow('', null).default('listingimage'),
                    // allow arbitrary string – relative paths (/uploads/xyz) or full URLs
                    url: Joi.string().allow('', null).default('https://unsplash.com/photos/a-view-of-rolling-hills-with-trees-in-the-foreground-cs-fGIqlKQs')
                }),
                Joi.string().allow('', null)
            )
            .default({ filename: 'listingimage', url: 'https://unsplash.com/photos/a-view-of-rolling-hills-with-trees-in-the-foreground-cs-fGIqlKQs' }),
    }).required()
});
     

module.exports.reviewSchema = Joi.object({
    review: Joi.object({
        rating : Joi.number().required().min(1).max(5),
        comment : Joi.string().required()
    }).required()
});

module.exports.bookingSchema = Joi.object({
    booking: Joi.object({
        startDate: Joi.date().required(),
        endDate: Joi.date().required(),
        guests: Joi.number().integer().min(1).default(1)
    }).required()
});