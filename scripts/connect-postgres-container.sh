#!/bin/bash

docker exec -it postgres_db psql -U postgres_db -d postgres_db

# -- Check installed extensions
# \dx

# -- Check table creation
# \dt