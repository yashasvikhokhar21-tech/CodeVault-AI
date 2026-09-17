const Booking = require('../models/booking');
const Listing = require('../models/listing');

module.exports.createBooking = async (req, res) => {
    const { id } = req.params; // listing id
    const listing = await Listing.findById(id);
    if (!listing) {
        req.flash('error', 'Listing not found.');
        return res.redirect('/listings');
    }
    const { startDate, endDate, guests } = req.body.booking;
    const booking = new Booking({
        listing: listing._id,
        user: req.user._id,
        startDate,
        endDate,
        guests
    });
    await booking.save();
    listing.bookings.push(booking._id);
    await listing.save();
    req.flash('success', 'Booking request submitted.');
    res.redirect(`/listings/${id}`);
};

module.exports.deleteBooking = async (req, res) => {
    const { id, bookingId } = req.params;
    await Booking.findByIdAndDelete(bookingId);
    await Listing.findByIdAndUpdate(id, { $pull: { bookings: bookingId } });
    req.flash('success', 'Booking cancelled.');
    res.redirect(`/listings/${id}`);
};

module.exports.acceptBooking = async (req, res) => {
    const { id, bookingId } = req.params;
    const booking = await Booking.findByIdAndUpdate(bookingId, { status: 'confirmed' }, { new: true });
    if (!booking) {
        req.flash('error', 'Booking not found.');
        return res.redirect(`/listings/${id}`);
    }
    req.flash('success', 'Booking request accepted.');
    res.redirect(`/listings/${id}`);
};

module.exports.declineBooking = async (req, res) => {
    const { id, bookingId } = req.params;
    const booking = await Booking.findByIdAndUpdate(bookingId, { status: 'cancelled' }, { new: true });
    if (!booking) {
        req.flash('error', 'Booking not found.');
        return res.redirect(`/listings/${id}`);
    }
    req.flash('success', 'Booking request declined.');
    res.redirect(`/listings/${id}`);
};
