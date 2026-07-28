'use strict';

const router = require('express').Router({ mergeParams: true });
const GroupController = require('../controllers/GroupController');
const { requireAnyAuth } = require('../middlewares/auth');

router.use(requireAnyAuth);

router.get('/groups', GroupController.list);
router.get('/contacts', GroupController.listContacts);

module.exports = router;
