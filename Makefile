# JUST A REMARK OF COMMANDS

login:
	pnpm login --scope=@ucla-irl --auth-type=legacy --

build:
	pnpm format && pnpm lint && pnpm build

publish:
	cd dist && pnpm publish
