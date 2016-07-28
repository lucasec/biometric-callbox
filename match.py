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
        results.append(dict(search=match[0], start=found.start, end=found.end, found=given[found.start:found.end]))

print(json.dumps(results))

