const Module = require('module');
const path = require('path');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
	if (request === 'vscode') {
		return path.join(__dirname, 'vscode-stub.js');
	}
	return originalResolve.call(this, request, ...rest);
};
