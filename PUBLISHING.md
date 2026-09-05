# Publishing Cloze Reader on GitHub

## First-time setup

1. Create a new repository at <https://github.com/new>. `cloze-reader` is a good name.
2. Choose **Public** if anyone should be able to download it. Do not initialize it with a README, license, or `.gitignore`; those files are already included.
3. In Terminal, change into this project directory and run:

   ```bash
   git init
   git add .
   git commit -m "Publish Cloze Reader 0.6.4"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/cloze-reader.git
   git push -u origin main
   ```

Replace `YOUR-USERNAME` with the GitHub username that owns the repository.

## Create the first downloadable release

Run:

```bash
git tag v0.6.4
git push origin v0.6.4
```

The included GitHub Actions workflow installs dependencies, runs the tests, builds Intel and Apple Silicon `.dmg` and `.zip` downloads, and creates a GitHub Release automatically. Watch its progress under the repository's **Actions** tab. Downloads appear under **Releases** when the job succeeds.

## Share it

Send friends the repository's Releases URL:

```text
https://github.com/YOUR-USERNAME/cloze-reader/releases/latest
```

Apple Silicon users should download the `arm64` DMG. Intel Mac users should download the `x64` DMG.

## Unsigned-app installation

This free release is not signed with an Apple Developer certificate. macOS will warn on first launch. The recipient should drag Cloze Reader to Applications, then right-click **Cloze Reader**, select **Open**, and confirm **Open**. They should not disable Gatekeeper globally.

## Future signed release

For ordinary double-click installation without the warning, enroll in the Apple Developer Program, create a Developer ID Application certificate, and configure code signing and notarization in the release workflow. Never commit certificates, passwords, or Apple credentials to the repository.
