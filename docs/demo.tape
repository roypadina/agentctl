# Demo GIF for agentctl — render with:  bash docs/demo-fixture.sh && vhs docs/demo.tape
# Records against a throwaway fake dataset (docs/demo-fixture.sh) — never real ~/.claude data.
Output docs/demo.gif

Set Shell "bash"
Set FontSize 15
Set Width 1080
Set Height 640
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

# point HOME/config/sessions at the fake dataset (HOME makes paths render as ~/code/…)
Hide
Type `export HOME=/private/tmp/acmdemo AGENTCTL_HOME=/private/tmp/acmdemo/.claude AGENTCTL_CONFIG=/private/tmp/acmdemo/config.toml PATH=/opt/homebrew/bin:$PATH`
Enter
Type "clear"
Enter
Show

# New — fuzzy-filter your projects
Type "agentctl"
Enter
Sleep 1.8s
Type "web"
Sleep 1.5s
Backspace 3
Sleep 400ms

# ⇥ to Resume — fuzzy-search a past session, peek the transcript
Tab
Sleep 2.5s
Down
Sleep 1.5s
Screenshot docs/screenshots/resume.png
Sleep 500ms
Type "/"
Sleep 300ms
Type "auth"
Sleep 600ms
Enter
Sleep 1.3s
Type "p"
Sleep 3.5s
Screenshot docs/screenshots/peek.png
Sleep 500ms
Escape
Sleep 700ms
Type "q"
Sleep 1.2s
