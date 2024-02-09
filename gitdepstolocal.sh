#! /usr/bin/env nix-shell
#! nix-shell -i bash -p git nodejs_18

# Check if argument is provided
if [ $# -eq 1 ]; then
  git reset --hard $1
fi

npm ls --package-lock-only | grep -o "github.com[^)]*" > libraries/gitdeps.txt
cd libraries

# Function to clone and reset repository
clone_and_reset() {
    local url="$1"
    local commit="$2"
    local repo_name=$(basename "$url" .git)

    # Check if the repository directory already exists
    if [ -d "$repo_name" ]; then
        echo "Repository $repo_name already exists. Resetting to commit $commit..."
        # Enter into the repository directory
        cd "$repo_name" || { echo "Failed to enter directory for $repo_name"; return 1; }
        # Reset to the specified commit
        git reset --hard "$commit" || { echo "Failed to reset to commit $commit"; return 1; }
    else
        # Clone the repository
        echo "Cloning $url..."
        git submodule add "$url" || { echo "Failed to clone $url"; return 1; }
        # Enter into the repository directory
        cd "$repo_name" || { echo "Failed to enter directory for $repo_name"; return 1; }
        # Reset to the specified commit
        echo "Resetting to commit $commit..."
        git reset --hard "$commit" || { echo "Failed to reset to commit $commit"; return 1; }
    fi
}

# Read file line by line
while IFS= read -r line || [ -n "$line" ]; do
    # Extract URL and Commit
    url="https://$(echo "$line" | cut -d'#' -f1)"
    commit=$(echo "$line" | cut -d'#' -f2)
    
    # Call clone_and_reset function
    (
      clone_and_reset "$url" "$commit"
    )

    # Return to the original directory
done < "gitdeps.txt"

cd ../

find . -name "package.json" -exec sed -i {} -e 's|"[github:]*overleaf\([^#]*\)#[^"]*|"\*|' \;
sed -i package-lock.json \
  -e 's|"[github:]*overleaf\([^#]*\)#[^"]*|"\*|' \
  -e 's|git+ssh://git@github.com/[^/]*/\(.*\).git[^"]*|file:libraries/\1|'
