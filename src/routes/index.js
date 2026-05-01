'use strict';

const { Router } = require('express');
const healthRouter = require('./health');

const router = Router();

// --- Core ---
router.use('/health', healthRouter);

// --- Domain routers ---
router.use('/auth', require('./auth'));
router.use('/user', require('./user'));
router.use('/user', require('./credentials'));
// router.use('/content',  require('./content'));
// router.use('/platforms',require('./platforms'));
// router.use('/publish',  require('./publish'));
// router.use('/analytics',require('./analytics'));

module.exports = router;
