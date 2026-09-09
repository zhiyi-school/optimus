from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main

from check_docs import validate


class DocumentationChecks(TestCase):
    def test_broken_link_and_machine_path_fail(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "README.md").write_text(
                "# Example\n\n[missing](docs/missing.md)\n\nUse `/Users/example/private/file`.\n",
                encoding="utf-8",
            )

            errors = validate(root)

        self.assertTrue(any("missing local link target" in error for error in errors))
        self.assertTrue(any("machine-specific path" in error for error in errors))


if __name__ == "__main__":
    main()
