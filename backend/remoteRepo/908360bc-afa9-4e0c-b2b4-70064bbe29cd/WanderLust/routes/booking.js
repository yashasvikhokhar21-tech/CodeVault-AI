const express = require('express');
const router = express.Router({ mergeParams: true });
const wrapAsync = require('../utils/wrapAsync');
const bookingsController = require('../controllers/bookings');
const { isLoggedIn, validateBooking, isBookingAuthor, isOwner } = require('../middleware');

// Create booking for a listing
router.post('/', isLoggedIn, validateBooking, wrapAsync(bookingsController.createBooking));

// Delete/cancel a booking
router.delete('/:bookingId', isLoggedIn, isBookingAuthor, wrapAsync(bookingsController.deleteBooking));

// Owner accepts a booking
router.post('/:bookingId/accept', isLoggedIn, isOwner, wrapAsync(bookingsController.acceptBooking));

// Owner declines a booking
router.post('/:bookingId/decline', isLoggedIn, isOwner, wrapAsync(bookingsController.declineBooking));

module.exports = router;
