# Security policy

## Scope

VoxNote is a client-side web application. It handles two kinds of sensitive
data: unpublished manuscripts under peer review, and the user's own API keys
for speech-to-text and LLM providers. Both stay in the user's browser; the
project runs no server.

## Supported versions

Pre-1.0: only the `main` branch and the latest release receive fixes.

## Reporting a vulnerability

Please do **not** open a public issue. Report privately:

- Preferred: GitHub private vulnerability reporting on this repository, once
  the repository is public and the feature has been verified as enabled (the
  verification date and evidence will be recorded here).
- Meanwhile: email the maintainer, Esteban Carisimo, at
  <estcarisimo@gmail.com> with the subject `[voxnote security]`.

You will get an acknowledgement within 7 days and a fix or a written
assessment within 90 days. Coordinated disclosure: we publish an advisory when
a fix is released and credit you unless you prefer otherwise.
