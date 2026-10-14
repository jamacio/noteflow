.PHONY: build test package install publish

build:
	npm run build

test:
	npm test

package:
	npm run package

install: package
	code --install-extension $$(ls -t *.vsix | head -n1)

publish:
	npx -y @vscode/vsce publish
