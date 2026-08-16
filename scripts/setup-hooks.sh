#!/bin/sh
# À lancer une fois après clonage du dépôt.
#
# Les hooks git ne sont pas versionnés dans .git/hooks : on les met dans
# .githooks/ (donc suivis par git, donc visibles en revue) et on pointe git
# dessus. Zéro dépendance, contrairement à husky (§9.1.8).
set -e
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
echo "✅ Hooks installés : core.hooksPath = .githooks"
echo "   Vérifier : git config core.hooksPath"
