module.exports = async function (context) {
  return [{ role: 'user', content: context.vars.message }];
};
