# google-services.json

The NOVA app uses Firebase for push notifications on Android. Its `google-services.json` file contains a project key,
so it is not committed to this repository.

To build the app, create your own Firebase project, add an Android app with the package name `solutions.bn.nova` (or
the package you set in `app.json`), download its `google-services.json` and place it at `app/google-services.json`.
The file is already ignored by git.

The same applies to `EXPO_PUBLIC_VOZ_TOKEN` in `app/eas.json`: the value there is a placeholder. Set it to the token
your own voice bridge expects (`NOVA_TOKEN` in `servidor/voz.mjs`), together with `EXPO_PUBLIC_VOZ_URL` and
`EXPO_PUBLIC_API_URL` pointing to your own services.

The full history of the app lives in the separate private repository `4mser/nova-app`.
