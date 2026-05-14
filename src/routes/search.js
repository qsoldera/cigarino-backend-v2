// search.js
const express = require('express');
const r1 = express.Router();
const { advancedSearch, getCountries } = require('../controllers/searchController');
r1.post('/advanced', advancedSearch);
r1.get('/countries', getCountries);
module.exports = r1;
