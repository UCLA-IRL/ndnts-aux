# NDNts Auxiliary Package for Web and Deno

## Usage

To install this module as a NPM module:
```bash
# Set the scope URL to GitHub
echo "@ucla-irl:registry=https://npm.pkg.github.com" >> .npmrc
# Install package using pnpm
pnpm add @ucla-irl/ndnts-aux
```

If you are asked to login, create a GitHub access token and use the following command:
```bash
pnpm login --scope=@ucla-irl --auth-type=legacy --registry=https://npm.pkg.github.com
# Use the token for password
```

The current release does not currently mark peer-dependencies.
So please ignore the warnings given by `pnpm`.
Just install NDNts nightly build as usual and it will work.

Unfortunately, the denoland release does not work. Please ignore that.

## TODOs

- Add more test
- Add a class for NDN workspace
- Add name pattern match and some ntschema for better namespace management.
