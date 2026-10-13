const { json: sendJson } = require('react-router');
const rr = require('react-router');

module.exports = function handler() {
  sendJson({});
  rr.defer(Promise.resolve(1));
  return require('react-router').json({ direct: true });
};
