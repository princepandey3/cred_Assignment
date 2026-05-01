'use strict';

const { Router } = require('express');
const healthRouter = require('./health');

const router = Router();

// --- Core ---
router.use('/health', healthRouter);

// --- Future domain routers (uncomment as you build them) ---
// router.use('/auth',     require('./auth'));
// router.use('/content',  require('./content'));
// router.use('/platforms',require('./platforms'));
// router.use('/publish',  require('./publish'));
// router.use('/analytics',require('./analytics'));

module.exports = router;
