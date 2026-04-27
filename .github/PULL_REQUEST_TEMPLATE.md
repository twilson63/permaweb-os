## Description

Add CI/CD documentation and PR template for automated deployment.

**Note:** Workflow files cannot be created via OAuth (missing `workflow` scope). After merging this PR, manually create `.github/workflows/ci.yml` using the content in `docs/GITHUB-ACTIONS.md`.

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [x] Documentation update
- [ ] Breaking change

## Testing

- [ ] Documentation reviewed for accuracy

## Manual Steps After Merge

1. Go to GitHub Settings > Secrets > Actions
2. Add `DIGITALOCEAN_ACCESS_TOKEN` secret
3. Create `.github/workflows/ci.yml` (see docs/GITHUB-ACTIONS.md)
4. Configure branch protection for `main`:
   - Require PR before merging
   - Require approvals: 1
   - Require status checks: `test`

## Related Issues

Implements automated deployment on merge to main.