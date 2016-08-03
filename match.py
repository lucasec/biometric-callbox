from fuzzysearch import find_near_matches
from fuzzywuzzy import process
import sys
import json

given = sys.argv[1]
choices = sys.argv[2:]

matches = process.extract(given, choices, limit=2)
results = []

for match in matches:
    near_match = find_near_matches(match[0], given, max_l_dist=10)
    if near_match:
        found = near_match[0]
        found_str = given[found.start:found.end]
        # Wrap beginning index into full word
        startPos = found.start
        while startPos == 1 or ((startPos - 1) > 0 and given[startPos - 1] != " "):
            startPos -= 1
        # Wrap end index into full word
        endPos = found.end
        while endPos == len(given) - 1 or (endPos < len(given) and given[endPos] != " "):
            endPos += 1

        results.append(dict(search=match[0], start=startPos, end=endPos, found=given[startPos:endPos]))

print(json.dumps(results))

