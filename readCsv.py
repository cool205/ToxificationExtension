import csv

def read_csv_first_column(file_path):
    with open(file_path, newline='', encoding='utf-8') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            if row:  # skip empty rows
                print(row[0])
                user_input = input("Press 'y' to continue, any other key to exit: ")
                if user_input.lower() != 'y':
                    break

# Replace 'your_file.csv' with the path to your CSV file
read_csv_first_column('data.csv')
